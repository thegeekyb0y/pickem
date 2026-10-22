export function profileInitials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => Array.from(part)[0]?.toLocaleUpperCase() ?? "").join("") ||
    Array.from(email.trim())[0]?.toLocaleUpperCase() ||
    "?";
}
