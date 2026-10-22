import DiscoverContent from "./discover-content";

export default async function Home({
  searchParams,
}: PageProps<"/">) {
  const params = await searchParams;
  const view = params.view === "closed" ? "closed" : "live";

  return <DiscoverContent view={view} />;
}
