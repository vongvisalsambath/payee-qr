/** ISO 4217 numeric code → alphabetic code and minor units, for the currencies payment QR codes use most. */
export interface Currency { numeric: string; code?: string; decimals?: number }

const TABLE: Record<string, [string, number]> = Object.assign(Object.create(null) as Record<string, [string, number]>, {
  "036": ["AUD", 2], "048": ["BHD", 3], "050": ["BDT", 2], "064": ["BTN", 2], "096": ["BND", 2], "104": ["MMK", 2], "116": ["KHR", 2],
  "124": ["CAD", 2], "144": ["LKR", 2], "152": ["CLP", 0], "156": ["CNY", 2], "170": ["COP", 2], "208": ["DKK", 2], "344": ["HKD", 2],
  "356": ["INR", 2], "360": ["IDR", 2], "376": ["ILS", 2], "392": ["JPY", 0], "398": ["KZT", 2], "404": ["KES", 2], "410": ["KRW", 0],
  "414": ["KWD", 3], "418": ["LAK", 2], "446": ["MOP", 2], "458": ["MYR", 2], "462": ["MVR", 2], "484": ["MXN", 2], "496": ["MNT", 2],
  "512": ["OMR", 3], "524": ["NPR", 2], "554": ["NZD", 2], "566": ["NGN", 2], "578": ["NOK", 2], "586": ["PKR", 2], "604": ["PEN", 2],
  "608": ["PHP", 2], "643": ["RUB", 2], "682": ["SAR", 2], "702": ["SGD", 2], "704": ["VND", 0], "710": ["ZAR", 2], "752": ["SEK", 2],
  "756": ["CHF", 2], "764": ["THB", 2], "784": ["AED", 2], "800": ["UGX", 0], "818": ["EGP", 2], "826": ["GBP", 2], "834": ["TZS", 2],
  "840": ["USD", 2], "860": ["UZS", 2], "901": ["TWD", 2], "949": ["TRY", 2], "978": ["EUR", 2], "985": ["PLN", 2], "986": ["BRL", 2],
});

export function currency(numeric: string): Currency {
  const hit = TABLE[numeric];
  return hit ? { numeric, code: hit[0], decimals: hit[1] } : { numeric };
}
