/** Recursively turn Prisma Decimals into strings for JSON responses. */
export function serialize<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value && typeof value === "object" && (value as { constructor?: { name?: string } }).constructor?.name === "Decimal") {
        return (value as { toString: () => string }).toString();
      }
      return value;
    })
  ) as T;
}
