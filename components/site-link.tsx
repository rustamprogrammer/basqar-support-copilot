import type { ComponentProps } from "react";

export type SiteLinkProps = Omit<ComponentProps<"a">, "href"> & { href: string };

// Vinext's next/link RSC navigation throws at runtime in this build and leaves
// the URL unchanged. Native anchors perform reliable full-page navigation while
// retaining normal link behavior, accessibility, refs and onClick cancellation.
export default function SiteLink({ href, ...props }: SiteLinkProps) {
  return <a href={href} {...props} />;
}
