import Link from "next/link";
import { getTimeline } from "@/lib/queries";
import { PostCard } from "@/components/PostCard";
import { NewPostsPill } from "@/components/NewPostsPill";
import { Empty, PageHeader } from "@/components/PageHeader";

export default async function Home({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const posts = await getTimeline({ filter });
  const tabs = [
    { key: "all", label: "Everything", href: "/" },
    { key: "originals", label: "From the news", href: "/?filter=originals" },
    { key: "conversations", label: "Conversations", href: "/?filter=conversations" },
  ];
  return (
    <>
      <PageHeader title="Home" tabs={tabs} active={filter} />
      <NewPostsPill newest={posts[0]?.id ?? null} />
      {posts.length ? (
        posts.map((post) => <PostCard key={post.id} post={post} />)
      ) : (
        <Empty title="Nothing posted yet">
          Start the worker with <code className="font-mono text-ink-2">npm run worker</code>, or go to{" "}
          <Link href="/ops" className="text-accent hover:underline">
            Ops
          </Link>{" "}
          to switch to replay or inject a headline.
        </Empty>
      )}
    </>
  );
}
