import { isValid, parseISO } from 'date-fns';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;

function convertDates<T>(obj: T): T {
  if (obj === null) {
    return null as T;
  }

  if (obj === undefined) {
    return undefined as T;
  }

  if (typeof obj === 'string') {
    if (ISO_DATE_REGEX.test(obj)) {
      const date = parseISO(obj);
      if (isValid(date)) {
        return date as unknown as T;
      }
      return undefined as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertDates(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = convertDates(value);
    }
    return converted as T;
  }

  return obj;
}

export async function customZodFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, options);

  const body = [204, 205, 304].includes(res.status) ? null : await res.text();

  const data = body ? JSON.parse(body) : {};
  const convertedData = convertDates(data);

  return convertedData as T;
}
