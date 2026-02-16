import { UserProfileForm } from '@/components/users/user-profile-form';

export default async function UserProfilePage({ params }: { params: Promise<{ email: string }> }) {
  const { email } = await params;

  return <UserProfileForm email={decodeURIComponent(email)} />;
}
