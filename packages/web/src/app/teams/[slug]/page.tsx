import { TeamDetail } from '@/components/teams/team-detail';

export default async function TeamDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return <TeamDetail slug={slug} />;
}
