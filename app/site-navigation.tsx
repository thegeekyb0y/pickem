"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";

function NavLink({
  href,
  active,
  children,
  className,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="default"
      className={cn(
        "font-fluid min-h-11 rounded-md px-4 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active && "bg-surface-2 text-foreground hover:bg-surface-2",
        className,
      )}
    >
      <Link href={href} aria-current={active ? "page" : undefined}>
        {children}
      </Link>
    </Button>
  );
}

function SignInAction({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      onClick={() => {
        void authClient.signIn.social({ provider: "google", callbackURL: "/profile" });
      }}
      className={cn(
        "font-fluid min-h-11 rounded-md px-4 text-sm font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      Sign in
    </Button>
  );
}

export default function SiteNavigation({ isSignedIn }: { isSignedIn: boolean }) {
  const pathname = usePathname() ?? "/";
  const discoverActive = pathname === "/" || pathname === "/discover";
  const createActive = pathname.startsWith("/events/new");
  const profileActive = pathname === "/profile" || pathname.startsWith("/profile/");

  return (
    <>
      <header className="hidden h-14 shrink-0 border-b border-border bg-background sm:block">
        <nav
          aria-label="Primary navigation"
          className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4 sm:px-6"
        >
          <Link
            href="/discover"
            className="rounded-sm text-base font-bold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Pickem
          </Link>
          <div className="flex items-center gap-2">
            <NavLink href="/discover" active={discoverActive}>
              Discover
            </NavLink>
            <NavLink href="/events/new" active={createActive}>
              Create
            </NavLink>
            {isSignedIn ? (
              <NavLink href="/profile" active={profileActive}>
                Profile
              </NavLink>
            ) : (
              <SignInAction />
            )}
          </div>
        </nav>
      </header>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <NavLink href="/discover" active={discoverActive} className="min-h-14 rounded-none px-2">
          Discover
        </NavLink>
        <NavLink href="/events/new" active={createActive} className="min-h-14 rounded-none px-2">
          Create
        </NavLink>
        {isSignedIn ? (
          <NavLink href="/profile" active={profileActive} className="min-h-14 rounded-none px-2">
            Profile
          </NavLink>
        ) : (
          <SignInAction className="min-h-14 rounded-none px-2" />
        )}
      </nav>
    </>
  );
}
