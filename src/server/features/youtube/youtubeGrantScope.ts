/**
 * A stored scope list that does not include `required`. Null or blank means
 * Google omitted the scope list and granted everything that was requested.
 */
export function grantOmitsScope(
  scope: string | null | undefined,
  required: string,
): boolean {
  if (scope == null || scope.trim() === "") return false;
  const granted = scope
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return !granted.includes(required);
}
