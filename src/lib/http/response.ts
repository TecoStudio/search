/** Read a JSON response without turning an empty or malformed body into a parse error. */
export async function readJsonResponse<T = unknown>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
