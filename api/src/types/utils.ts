// =============================================================================
// UTILITY TYPE HELPERS
// =============================================================================

/**
 * Safe error message extraction from unknown error types
 * Handles Error objects, strings, and other types safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return JSON.stringify(error);
}

/**
 * Generic nullable type guard
 * Helps TypeScript understand that a value is not null/undefined
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard for checking if an object has a specific property
 */
export function hasProperty<T extends object, K extends string>(
  obj: T,
  prop: K
): obj is T & Record<K, unknown> {
  return prop in obj;
}

/**
 * Safe number parsing with fallback
 */
export function safeParseNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

/**
 * Safe string conversion
 */
export function safeString(value: unknown, fallback: string = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/**
 * Type assertion helper for Map iterations
 */
export function assertMap<K, V>(map: unknown): Map<K, V> {
  if (map instanceof Map) return map as Map<K, V>;
  throw new Error("Expected Map instance");
}

/**
 * Type assertion helper for Set iterations
 */
export function assertSet<T>(set: unknown): Set<T> {
  if (set instanceof Set) return set as Set<T>;
  throw new Error("Expected Set instance");
}

/**
 * Safe array access with bounds checking
 */
export function safeArrayAccess<T>(array: T[], index: number): T | undefined {
  return index >= 0 && index < array.length ? array[index] : undefined;
}

/**
 * Type guard for checking if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Type guard for checking if value is a valid number
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value) && isFinite(value);
}