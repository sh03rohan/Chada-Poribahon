const DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** Convert ASCII digits in a string/number to Bangla numerals. */
export function bn(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => DIGITS[+d]);
}

export function bnTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return bn(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
}

export function bnKm(metres: number): string {
  return bn((metres / 1000).toFixed(1)) + ' কিমি';
}

export function bnTaka(amount: number): string {
  return '৳' + bn(Math.round(amount).toLocaleString('en-US'));
}

/** "রাত ১০:৩০" style clock label for a decimal hour. */
export function bnClock(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const part = hh < 4 ? 'রাত' : hh < 6 ? 'ভোর' : hh < 12 ? 'সকাল' : hh < 15 ? 'দুপুর' : hh < 18 ? 'বিকেল' : hh < 20 ? 'সন্ধ্যা' : 'রাত';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${part} ${bn(h12)}:${bn(String(mm).padStart(2, '0'))}`;
}
