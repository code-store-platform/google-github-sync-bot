'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, Mail, User } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GithubIcon } from '@/components/ui/github-icon';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from './status-badge';
import { UserTeamsCard } from './user-teams-card';
import { UserReposCard } from './user-repos-card';

export function UserProfileForm({ email }: { email: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editValue, setEditValue] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    data: user,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['user', email],
    queryFn: () => api.getUser(email),
  });

  const mutation = useMutation({
    mutationFn: (githubUsername: string) => api.updateGitHubUsername(email, githubUsername),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', email] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowConfirm(false);
      toast({ title: 'GitHub username updated', description: `Updated to "${editValue}"` });
    },
    onError: (err) => {
      toast({
        title: 'Failed to update',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleEditSubmit = () => {
    setShowConfirm(true);
  };

  const handleConfirm = () => {
    mutation.mutate(editValue);
  };

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  if (error || !user) {
    return (
      <div className="space-y-4">
        <Link
          href="/users"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load user</p>
          <p className="text-sm text-muted-foreground mt-1">{error?.message || 'User not found'}</p>
        </div>
      </div>
    );
  }

  const hasChanged = editValue !== (user.githubUsername || '');

  return (
    <div className="space-y-6">
      <Link
        href="/users"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to users
      </Link>

      {/* Profile Header */}
      <div className="flex items-center gap-4">
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 rounded-full"
          />
        ) : (
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-xl font-medium text-muted-foreground">
            {(user.name || user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h2 className="text-2xl font-bold">{user.name || user.email}</h2>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <div className="ml-auto">
          <StatusBadge status={user.status} />
        </div>
      </div>

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Name</p>
                <p className="text-sm text-muted-foreground">{user.name || 'Not set'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <GithubIcon className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">GitHub Username</p>
                <p className="text-sm text-muted-foreground">
                  {user.githubUsername ? (
                    <a
                      href={`https://github.com/${user.githubUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {user.githubUsername}
                    </a>
                  ) : (
                    'Not linked'
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit GitHub Username</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleEditSubmit();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="githubUsername">GitHub Username</Label>
                <Input
                  id="githubUsername"
                  placeholder="e.g. octocat"
                  defaultValue={user.githubUsername || ''}
                  onChange={(e) => setEditValue(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={!hasChanged || mutation.isPending}>
                {mutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Teams */}
      <UserTeamsCard user={user} />

      {/* Repositories */}
      <UserReposCard user={user} />

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm GitHub Username Change</DialogTitle>
            <DialogDescription>
              You are about to change the GitHub username for <strong>{user.email}</strong> from{' '}
              <strong>{user.githubUsername || '(empty)'}</strong> to{' '}
              <strong>{editValue || '(empty)'}</strong>. This will update the Google Workspace
              custom schema.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-px w-full" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
