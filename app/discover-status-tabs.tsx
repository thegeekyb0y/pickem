"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";

export default function DiscoverStatusTabs({
  view,
  children,
}: {
  view: "live" | "closed";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/discover";
  const searchParams = useSearchParams();

  function changeView(nextView: string) {
    if (nextView !== "live" && nextView !== "closed") return;
    const params = new URLSearchParams(searchParams?.toString());
    if (nextView === "live") params.delete("view");
    else params.set("view", "closed");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Tabs value={view} onValueChange={changeView} size="compact">
      <TabsList
        aria-label="Poll status"
        indicator="flat"
        className="w-full justify-start rounded-none border-b border-border bg-transparent p-0 pb-1 [--focus-ring:var(--muted-foreground)]"
      >
        <TabItem
          value="live"
          label="Live & upcoming"
          className="min-h-9 px-3"
        />
        <TabItem value="closed" label="Closed" className="min-h-9 px-3" />
      </TabsList>
      <TabPanel value="live" className="mt-6">
        {view === "live" ? children : null}
      </TabPanel>
      <TabPanel value="closed" className="mt-6">
        {view === "closed" ? children : null}
      </TabPanel>
    </Tabs>
  );
}
