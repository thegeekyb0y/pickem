import DiscoverContent from "../discover-content";

export default async function DiscoverPage({
  searchParams,
}: PageProps<"/discover">) {
  const params = await searchParams;
  const view = params.view === "closed" ? "closed" : "live";
  return <DiscoverContent view={view} />;
}
