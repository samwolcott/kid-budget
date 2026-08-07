type KidSlug = "judah" | "max";
type AvatarSize = "small" | "medium" | "large";

const sizeClasses: Record<AvatarSize, string> = {
  small: "h-9 w-9 rounded-xl text-base",
  medium: "h-12 w-12 rounded-2xl text-xl",
  large: "h-14 w-14 rounded-2xl text-2xl",
};

export function profileAvatarClasses(
  slug: KidSlug,
  size: AvatarSize = "medium",
): string {
  const colors = slug === "judah"
    ? "bg-blue-600 ring-blue-200"
    : "bg-emerald-600 ring-emerald-200";

  return `grid shrink-0 place-items-center font-black text-white shadow-sm ring-2 ${colors} ${sizeClasses[size]}`;
}

export function profileAvatarSymbol(slug: KidSlug): "J" | "M" {
  return slug === "judah" ? "J" : "M";
}

export function profileAvatarHtml(
  slug: KidSlug,
  size: AvatarSize = "medium",
): string {
  return `<span class="${profileAvatarClasses(slug, size)}" aria-hidden="true">${profileAvatarSymbol(slug)}</span>`;
}
