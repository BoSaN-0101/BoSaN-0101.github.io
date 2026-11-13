declare module 'lunar-javascript' {
  export interface Lunar {
    getDayYi(): string[];
    getDayJi(): string[];
    getYearInGanZhi(): string;
    getYearShengXiao(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
  }
  export interface SolarInstance {
    getLunar(): Lunar;
  }
  export const Solar: { fromYmd(y: number, m: number, d: number): SolarInstance };
}
