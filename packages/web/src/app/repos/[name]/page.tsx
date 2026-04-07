import { RepoDetail } from '@/components/repos/repo-detail';

export default async function RepoDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  return <RepoDetail name={name} />;
}
