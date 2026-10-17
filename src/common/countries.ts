import { type AnyColumn, type SQL, eq, isNull, or } from 'drizzle-orm';

/**
 * Country reference data used for defaults (currency, emergency number, time zone, language) and for
 * phone-number parsing. Names are not stored: clients render them with Intl.DisplayNames in the user's language.
 *
 * Emergency numbers are the main general/police number. Several countries have separate ambulance and fire
 * numbers; people can always set their own number in Help settings. Review this list before launching in a
 * new country.
 *
 * Format per line: CODE CURRENCY EMERGENCY TIMEZONE LANGUAGE
 */
const RAW = `
AD EUR 112 Europe/Andorra ca
AE AED 999 Asia/Dubai ar
AF AFN 119 Asia/Kabul fa
AG XCD 911 America/Antigua en
AL ALL 112 Europe/Tirane sq
AM AMD 112 Asia/Yerevan hy
AO AOA 113 Africa/Luanda pt
AR ARS 911 America/Argentina/Buenos_Aires es
AT EUR 112 Europe/Vienna de
AU AUD 000 Australia/Sydney en
AZ AZN 112 Asia/Baku az
BA BAM 112 Europe/Sarajevo bs
BB BBD 211 America/Barbados en
BD BDT 999 Asia/Dhaka bn
BE EUR 112 Europe/Brussels nl
BF XOF 17 Africa/Ouagadougou fr
BG BGN 112 Europe/Sofia bg
BH BHD 999 Asia/Bahrain ar
BI BIF 117 Africa/Bujumbura fr
BJ XOF 117 Africa/Porto-Novo fr
BN BND 993 Asia/Brunei ms
BO BOB 110 America/La_Paz es
BR BRL 190 America/Sao_Paulo pt
BS BSD 911 America/Nassau en
BT BTN 113 Asia/Thimphu dz
BW BWP 999 Africa/Gaborone en
BY BYN 102 Europe/Minsk be
BZ BZD 911 America/Belize en
CA CAD 911 America/Toronto en
CD CDF 112 Africa/Kinshasa fr
CF XAF 117 Africa/Bangui fr
CG XAF 117 Africa/Brazzaville fr
CH CHF 112 Europe/Zurich de
CI XOF 111 Africa/Abidjan fr
CL CLP 133 America/Santiago es
CM XAF 117 Africa/Douala fr
CN CNY 110 Asia/Shanghai zh
CO COP 123 America/Bogota es
CR CRC 911 America/Costa_Rica es
CU CUP 106 America/Havana es
CV CVE 132 Atlantic/Cape_Verde pt
CY EUR 112 Asia/Nicosia el
CZ CZK 112 Europe/Prague cs
DE EUR 112 Europe/Berlin de
DJ DJF 17 Africa/Djibouti fr
DK DKK 112 Europe/Copenhagen da
DM XCD 999 America/Dominica en
DO DOP 911 America/Santo_Domingo es
DZ DZD 17 Africa/Algiers ar
EC USD 911 America/Guayaquil es
EE EUR 112 Europe/Tallinn et
EG EGP 122 Africa/Cairo ar
ER ERN 113 Africa/Asmara ti
ES EUR 112 Europe/Madrid es
ET ETB 911 Africa/Addis_Ababa am
FI EUR 112 Europe/Helsinki fi
FJ FJD 911 Pacific/Fiji en
FM USD 911 Pacific/Pohnpei en
FR EUR 112 Europe/Paris fr
GA XAF 1730 Africa/Libreville fr
GB GBP 999 Europe/London en
GD XCD 911 America/Grenada en
GE GEL 112 Asia/Tbilisi ka
GH GHS 112 Africa/Accra en
GM GMD 117 Africa/Banjul en
GN GNF 117 Africa/Conakry fr
GQ XAF 114 Africa/Malabo es
GR EUR 112 Europe/Athens el
GT GTQ 110 America/Guatemala es
GW XOF 117 Africa/Bissau pt
GY GYD 911 America/Guyana en
HK HKD 999 Asia/Hong_Kong zh
HN HNL 911 America/Tegucigalpa es
HR EUR 112 Europe/Zagreb hr
HT HTG 114 America/Port-au-Prince fr
HU HUF 112 Europe/Budapest hu
ID IDR 112 Asia/Jakarta id
IE EUR 112 Europe/Dublin en
IL ILS 100 Asia/Jerusalem he
IN INR 112 Asia/Kolkata hi
IQ IQD 104 Asia/Baghdad ar
IR IRR 110 Asia/Tehran fa
IS ISK 112 Atlantic/Reykjavik is
IT EUR 112 Europe/Rome it
JM JMD 119 America/Jamaica en
JO JOD 911 Asia/Amman ar
JP JPY 110 Asia/Tokyo ja
KE KES 999 Africa/Nairobi en
KG KGS 112 Asia/Bishkek ky
KH KHR 117 Asia/Phnom_Penh km
KI AUD 999 Pacific/Tarawa en
KM KMF 17 Indian/Comoro ar
KN XCD 911 America/St_Kitts en
KR KRW 112 Asia/Seoul ko
KW KWD 112 Asia/Kuwait ar
KZ KZT 112 Asia/Almaty kk
LA LAK 191 Asia/Vientiane lo
LB LBP 112 Asia/Beirut ar
LC XCD 911 America/St_Lucia en
LI CHF 112 Europe/Vaduz de
LK LKR 119 Asia/Colombo si
LR LRD 911 Africa/Monrovia en
LS LSL 112 Africa/Maseru en
LT EUR 112 Europe/Vilnius lt
LU EUR 112 Europe/Luxembourg fr
LV EUR 112 Europe/Riga lv
LY LYD 1515 Africa/Tripoli ar
MA MAD 19 Africa/Casablanca ar
MC EUR 112 Europe/Monaco fr
MD MDL 112 Europe/Chisinau ro
ME EUR 112 Europe/Podgorica sr
MG MGA 117 Indian/Antananarivo mg
MH USD 911 Pacific/Majuro en
MK MKD 112 Europe/Skopje mk
ML XOF 17 Africa/Bamako fr
MM MMK 199 Asia/Yangon my
MN MNT 102 Asia/Ulaanbaatar mn
MO MOP 999 Asia/Macau zh
MR MRU 117 Africa/Nouakchott ar
MT EUR 112 Europe/Malta mt
MU MUR 999 Indian/Mauritius en
MV MVR 119 Indian/Maldives dv
MW MWK 997 Africa/Blantyre en
MX MXN 911 America/Mexico_City es
MY MYR 999 Asia/Kuala_Lumpur ms
MZ MZN 119 Africa/Maputo pt
NA NAD 10111 Africa/Windhoek en
NE XOF 17 Africa/Niamey fr
NG NGN 112 Africa/Lagos en
NI NIO 118 America/Managua es
NL EUR 112 Europe/Amsterdam nl
NO NOK 112 Europe/Oslo no
NP NPR 100 Asia/Kathmandu ne
NR AUD 110 Pacific/Nauru en
NZ NZD 111 Pacific/Auckland en
OM OMR 9999 Asia/Muscat ar
PA PAB 911 America/Panama es
PE PEN 105 America/Lima es
PG PGK 112 Pacific/Port_Moresby en
PH PHP 911 Asia/Manila en
PK PKR 15 Asia/Karachi ur
PL PLN 112 Europe/Warsaw pl
PR USD 911 America/Puerto_Rico es
PS ILS 100 Asia/Gaza ar
PT EUR 112 Europe/Lisbon pt
PW USD 911 Pacific/Palau en
PY PYG 911 America/Asuncion es
QA QAR 999 Asia/Qatar ar
RO RON 112 Europe/Bucharest ro
RS RSD 112 Europe/Belgrade sr
RU RUB 112 Europe/Moscow ru
RW RWF 112 Africa/Kigali rw
SA SAR 911 Asia/Riyadh ar
SB SBD 999 Pacific/Guadalcanal en
SC SCR 999 Indian/Mahe en
SD SDG 999 Africa/Khartoum ar
SE SEK 112 Europe/Stockholm sv
SG SGD 999 Asia/Singapore en
SI EUR 112 Europe/Ljubljana sl
SK EUR 112 Europe/Bratislava sk
SL SLE 999 Africa/Freetown en
SM EUR 112 Europe/San_Marino it
SN XOF 17 Africa/Dakar fr
SO SOS 888 Africa/Mogadishu so
SR SRD 115 America/Paramaribo nl
SS SSP 777 Africa/Juba en
ST STN 112 Africa/Sao_Tome pt
SV USD 911 America/El_Salvador es
SY SYP 112 Asia/Damascus ar
SZ SZL 999 Africa/Mbabane en
TD XAF 17 Africa/Ndjamena fr
TG XOF 117 Africa/Lome fr
TH THB 191 Asia/Bangkok th
TJ TJS 112 Asia/Dushanbe tg
TL USD 112 Asia/Dili pt
TM TMT 02 Asia/Ashgabat tk
TN TND 197 Africa/Tunis ar
TO TOP 911 Pacific/Tongatapu en
TR TRY 112 Europe/Istanbul tr
TT TTD 999 America/Port_of_Spain en
TV AUD 911 Pacific/Funafuti en
TW TWD 110 Asia/Taipei zh
TZ TZS 112 Africa/Dar_es_Salaam sw
UA UAH 112 Europe/Kyiv uk
UG UGX 999 Africa/Kampala en
US USD 911 America/New_York en
UY UYU 911 America/Montevideo es
UZ UZS 112 Asia/Tashkent uz
VA EUR 112 Europe/Vatican it
VC XCD 911 America/St_Vincent en
VE VES 911 America/Caracas es
VN VND 113 Asia/Ho_Chi_Minh vi
VU VUV 112 Pacific/Efate en
WS WST 911 Pacific/Apia en
XK EUR 112 Europe/Belgrade sq
YE YER 194 Asia/Aden ar
ZA ZAR 10111 Africa/Johannesburg en
ZM ZMW 999 Africa/Lusaka en
ZW ZWL 999 Africa/Harare en
`;

export interface CountryInfo {
  code: string;
  currency: string;
  emergency: string;
  timezone: string;
  language: string;
}

export const COUNTRIES: Record<string, CountryInfo> = Object.fromEntries(
  RAW.trim()
    .split('\n')
    .map((line) => {
      const [code, currency, emergency, timezone, language] = line.trim().split(/\s+/);
      return [code, { code, currency, emergency, timezone, language }];
    }),
);

/** Fallback when a country is unknown: 112 works on GSM mobile networks in most of the world. */
export const DEFAULT_COUNTRY: CountryInfo = { code: '', currency: 'USD', emergency: '112', timezone: 'UTC', language: 'en' };

export function countryInfo(code?: string | null): CountryInfo {
  return (code && COUNTRIES[code.toUpperCase()]) || DEFAULT_COUNTRY;
}

export function isCountryCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{2}$/.test(code) && code in COUNTRIES;
}

/** Best-effort country from an IANA time zone (exact primary-zone match), e.g. Europe/London → GB. */
export function countryFromTimezone(tz?: string | null): string | null {
  if (!tz) return null;
  const hit = Object.values(COUNTRIES).find((c) => c.timezone === tz);
  if (hit) return hit.code;
  const aliases: Record<string, string> = { 'Asia/Calcutta': 'IN', 'America/Los_Angeles': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US', 'America/Vancouver': 'CA', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Europe/Kiev': 'UA', 'Asia/Saigon': 'VN', 'Asia/Rangoon': 'MM', 'Asia/Katmandu': 'NP' };
  return aliases[tz] ?? null;
}

/** SQL filter: rows for this country plus rows with no country (global). No country → everything. */
export function forCountry(column: AnyColumn, country: string | null | undefined): SQL | undefined {
  return country ? or(isNull(column), eq(column, country)) : undefined;
}

/** English country name for prompts and emails, e.g. GB → "United Kingdom". */
export function countryName(code?: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** English language name, e.g. "hi-IN" → "Hindi". */
export function languageName(locale?: string | null): string {
  if (!locale) return 'English';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale.split('-')[0]) ?? 'English';
  } catch {
    return 'English';
  }
}
