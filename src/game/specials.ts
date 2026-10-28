import { bn, bnTaka } from '../util/bangla.ts';

/**
 * Special passengers: at a stop a named passenger boards with a small request for the ride to the
 * next stop ("no hard brakes", "get me there fast", "don't honk — the baby sleeps"). Keep it and
 * they tip; break it and they grumble and the whole bus's mood dips.
 */
export interface SegmentMetrics {
  timeSec: number; distM: number; hardBrakes: number; swerves: number; fines: number; crashes: number; horns: number; maxKmh: number; mood: number;
}
export interface SpecialDef {
  id: string; icon: string; name: string;
  variant: number;                       // VARIANTS index for the walking figure
  greet: string;                         // said while boarding
  goal: (m: { distM: number }) => string; // the request, shown in the HUD pill
  tip: number;
  thanks: string; sorry: string;
  check: (m: SegmentMetrics) => boolean;
}

/** seconds allowed for a segment at a given average km/h */
const allowSec = (distM: number, kmh: number) => Math.round(distM / (kmh / 3.6)) + 12;

export const SPECIALS: SpecialDef[] = [
  { id: 'dadi', icon: '👵', name: 'দাদি', variant: 10, tip: 200,
    greet: '“বাবা, আস্তে চালাইও — কোমরে ব্যথা, ঝাঁকি সহ্য হয় না।”',
    goal: () => 'পরের স্টপ পর্যন্ত হার্ড ব্রেক নয়, ঝাঁকুনি সর্বোচ্চ ১টা',
    thanks: '“দোয়া করি বাবা, এই নাও মিষ্টি খাওয়ার টাকা।”', sorry: '“এভাবে চালালে বুড়ো মানুষ বাঁচে না, বাবা!”',
    check: (m) => m.hardBrakes === 0 && m.swerves <= 1 },
  { id: 'student', icon: '🎒', name: 'পরীক্ষার্থী', variant: 6, tip: 150,
    greet: '“ভাই, ১০টায় পরীক্ষা! একটু জলদি, প্লিজ!”',
    goal: (m) => `পরের স্টপে ${bn(allowSec(m.distM, 55))} সেকেন্ডের মধ্যে পৌঁছান`,
    thanks: '“ইয়েস! সময়মতো পৌঁছে গেলাম — ধন্যবাদ ভাই!”', sorry: '“পরীক্ষা মিস হয়ে গেল… আর কখনো এই বাসে না।”',
    check: (m) => m.timeSec <= allowSec(m.distM, 55) },
  { id: 'patient', icon: '🏥', name: 'রোগীর সাথে ভাবি', variant: 7, tip: 400,
    greet: '“আম্মাকে হাসপাতালে নিচ্ছি — জলদি, কিন্তু ঝাঁকি দেবেন না।”',
    goal: (m) => `${bn(allowSec(m.distM, 50))} সেকেন্ডের মধ্যে, হার্ড ব্রেক সর্বোচ্চ ১টা, ধাক্কা নয়`,
    thanks: '“আল্লাহ আপনার ভালো করুক — এটা রাখেন।”', sorry: '“রোগী নিয়ে এভাবে কেউ চালায়?”',
    check: (m) => m.timeSec <= allowSec(m.distM, 50) && m.hardBrakes <= 1 && m.crashes === 0 },
  { id: 'business', icon: '📱', name: 'ব্যবসায়ী সাহেব', variant: 9, tip: 250,
    greet: '“ড্রাইভার, জরুরি কল আছে — হর্ন কম দিয়েন, আর কাগজপত্র ঠিক রাখেন।”',
    goal: () => 'পরের স্টপ পর্যন্ত হর্ন সর্বোচ্চ ২ বার, কোনো জরিমানা নয়',
    thanks: '“ডিলটা হয়ে গেল — বকশিশ নেন।”', sorry: '“সারা রাস্তা হর্ন! কথাই শুনতে পারলাম না।”',
    check: (m) => m.horns <= 2 && m.fines === 0 },
  { id: 'mother', icon: '👶', name: 'বাচ্চাসহ মা', variant: 3, tip: 300,
    greet: '“বাচ্চাটা মাত্র ঘুমালো — হর্ন আর হার্ড ব্রেক দেবেন না, ভাই।”',
    goal: () => 'পরের স্টপ পর্যন্ত হর্ন নয়, হার্ড ব্রেক নয়',
    thanks: '“ঘুম ভাঙেনি! আপনি মানুষ ভালো — এটা রাখেন।”', sorry: '“কেঁদে কেঁদে অস্থির… কী দরকার ছিল হর্নের?”',
    check: (m) => m.horns === 0 && m.hardBrakes === 0 },
  { id: 'tourist', icon: '📷', name: 'ছবিওয়ালা', variant: 4, tip: 350,
    greet: '“ভাই, গ্রামের ছবি তুলব — ৬৫-এর নিচে চালান, প্লিজ।”',
    goal: () => 'পরের স্টপ পর্যন্ত গতি ৬৫ কিমি/ঘ-এর নিচে রাখুন',
    thanks: '“দারুণ সব ছবি হলো! এই নিন চা-পানির টাকা।”', sorry: '“সব ছবি ঝাপসা… এত জোরে কে চালায়?”',
    check: (m) => m.maxKmh < 65 },
];

export interface ActiveSpecial { def: SpecialDef; boardStop: number; start: SegmentMetrics; maxKmh: number; }

export function describeOutcome(def: SpecialDef, ok: boolean): string {
  return ok ? `${def.icon} ${def.name} খুশি — বকশিশ +${bnTaka(def.tip)}` : `${def.icon} ${def.name} অখুশি — বকশিশ নেই, যাত্রীর মেজাজ পড়ল`;
}
