import { convertDates } from '@core/util/date';

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
