'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { PrivacyBadge } from './privacy-badge';
import { RoleBadge } from './role-badge';
import { UserAutocomplete } from './user-autocomplete';

export function TeamDetail({ slug }: { slug: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: team,
    isLoading: teamLoading,
    error: teamError,
  } = useQuery({
    queryKey: ['team', slug],
    queryFn: () => api.getTeam(slug),
  });

  const {
    data: members,
    isLoading: membersLoading,
    error: membersError,
  } = useQuery({
    queryKey: ['team-members', slug],
    queryFn: () => api.getTeamMembers(slug),
  });

  const { data: workspaceUsers } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
  });

  // Map GitHub username (lowercase) → workspace user info
  const workspaceLookup = useMemo(() => {
    const map = new Map<string, { email: string; name: string | null }>();
    if (!workspaceUsers) return map;
    for (const u of workspaceUsers) {
      if (u.githubUsername) {
        map.set(u.githubUsername.toLowerCase(), { email: u.email, name: u.name });
      }
    }
    return map;
  }, [workspaceUsers]);

  if (teamLoading || membersLoading) {
    return <TeamDetailSkeleton />;
  }

  if (teamError || !team) {
    return (
      <div className="space-y-4">
        <Link
          href="/teams"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to teams
        </Link>
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load team</p>
          <p className="text-sm text-muted-foreground mt-1">
            {teamError?.message || 'Team not found'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/teams"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to teams
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold leading-none">{team.name}</h2>
          <PrivacyBadge privacy={team.privacy} />
        </div>
        <p className="text-muted-foreground text-sm">{team.slug}</p>
      </div>

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        <TeamInfoCard
          slug={slug}
          team={team}
          toast={toast}
          queryClient={queryClient}
          router={router}
        />
        <TeamMembersCard
          slug={slug}
          members={members || []}
          membersError={membersError}
          workspaceLookup={workspaceLookup}
          workspaceUsers={workspaceUsers || []}
          toast={toast}
          queryClient={queryClient}
        />
      </div>
    </div>
  );
}

function TeamInfoCard({
  slug,
  team,
  toast,
  queryClient,
  router,
}: {
  slug: string;
  team: NonNullable<ReturnType<typeof api.getTeam> extends Promise<infer T> ? T : never>;
  toast: ReturnType<typeof useToast>['toast'];
  queryClient: ReturnType<typeof useQueryClient>;
  router: ReturnType<typeof useRouter>;
}) {
  const [editName, setEditName] = useState(team.name);
  const [editDescription, setEditDescription] = useState(team.description || '');
  const [editPrivacy, setEditPrivacy] = useState(team.privacy);
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () =>
      api.updateTeam(slug, {
        name: editName,
        description: editDescription,
        privacy: editPrivacy,
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['team', slug] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setShowUpdateConfirm(false);
      toast({ title: 'Team updated', description: `"${updated.name}" has been updated.` });
      if (updated.slug !== slug) {
        router.replace(`/teams/${updated.slug}`);
      }
    },
    onError: (err) => {
      toast({ title: 'Failed to update team', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTeam(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast({ title: 'Team deleted', description: `"${team.name}" has been deleted.` });
      router.push('/teams');
    },
    onError: (err) => {
      toast({ title: 'Failed to delete team', description: err.message, variant: 'destructive' });
    },
  });

  const hasChanges =
    editName !== team.name ||
    editDescription !== (team.description || '') ||
    editPrivacy !== team.privacy;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 text-sm">
            <p className="font-medium">Members</p>
            <p className="text-muted-foreground">{team.membersCount}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Repositories</p>
            <p className="text-muted-foreground">{team.reposCount}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Created</p>
            <p className="text-muted-foreground">{formatDate(team.createdAt)}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Last updated</p>
            <p className="text-muted-foreground">{formatDate(team.updatedAt)}</p>
          </div>

          <Separator />

          {/* Edit form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowUpdateConfirm(true);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Privacy</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={editPrivacy === 'closed' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEditPrivacy('closed')}
                >
                  Visible
                </Button>
                <Button
                  type="button"
                  variant={editPrivacy === 'secret' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEditPrivacy('secret')}
                >
                  Secret
                </Button>
              </div>
            </div>
            <Button type="submit" disabled={!hasChanges || updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>

          <Separator />

          <Button
            variant="destructive"
            className="w-full"
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete Team
          </Button>
        </CardContent>
      </Card>

      {/* Update Confirmation Dialog */}
      <Dialog open={showUpdateConfirm} onOpenChange={setShowUpdateConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Team Update</DialogTitle>
            <DialogDescription>
              You are about to update <strong>{team.name}</strong>. This will modify the team on
              GitHub.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{team.name}</strong>? This action cannot be
              undone. The team will be permanently removed from GitHub.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TeamMembersCard({
  slug,
  members,
  membersError,
  workspaceLookup,
  workspaceUsers,
  toast,
  queryClient,
}: {
  slug: string;
  members: Awaited<ReturnType<typeof api.getTeamMembers>>;
  membersError: Error | null;
  workspaceLookup: Map<string, { email: string; name: string | null }>;
  workspaceUsers: import('@/lib/types').UserListItem[];
  toast: ReturnType<typeof useToast>['toast'];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'member' | 'maintainer'>('member');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const existingMembers = useMemo(
    () => new Set(members.map((m) => m.login.toLowerCase())),
    [members],
  );

  const addMutation = useMutation({
    mutationFn: () => api.addTeamMember(slug, { username: username.trim(), role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members', slug] });
      queryClient.invalidateQueries({ queryKey: ['team', slug] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast({ title: 'Member added', description: `${username} has been added to the team.` });
      setUsername('');
      setRole('member');
    },
    onError: (err) => {
      toast({ title: 'Failed to add member', description: err.message, variant: 'destructive' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (target: string) => api.removeTeamMember(slug, target),
    onSuccess: (_, target) => {
      queryClient.invalidateQueries({ queryKey: ['team-members', slug] });
      queryClient.invalidateQueries({ queryKey: ['team', slug] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setRemoveTarget(null);
      toast({ title: 'Member removed', description: `${target} has been removed from the team.` });
    },
    onError: (err) => {
      toast({
        title: 'Failed to remove member',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add member form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!username.trim()) return;
              addMutation.mutate();
            }}
            className="space-y-3"
          >
            <div className="flex gap-2">
              <UserAutocomplete
                value={username}
                onChange={setUsername}
                workspaceUsers={workspaceUsers}
                existingMembers={existingMembers}
              />
              <Button type="submit" size="sm" disabled={!username.trim() || addMutation.isPending}>
                {addMutation.isPending ? 'Adding...' : 'Add'}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={role === 'member' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRole('member')}
              >
                Member
              </Button>
              <Button
                type="button"
                variant={role === 'maintainer' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRole('maintainer')}
              >
                Maintainer
              </Button>
            </div>
          </form>

          <Separator />

          {/* Member list */}
          {membersError ? (
            <p className="text-sm text-destructive">Failed to load members</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No members yet</p>
          ) : (
            <div className="space-y-2">
              {members.map((member) => {
                const wsUser = workspaceLookup.get(member.login.toLowerCase());
                return (
                  <div key={member.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                    <Image
                      src={member.avatarUrl}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-full"
                    />
                    <div className="flex-1 min-w-0">
                      {wsUser ? (
                        <>
                          <p className="text-sm font-medium truncate">
                            {wsUser.name || wsUser.email}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {wsUser.email} <span className="font-mono">({member.login})</span>
                          </p>
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={member.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium font-mono hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {member.login}
                          </a>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <RoleBadge role={member.role} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setRemoveTarget(member.login)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remove member confirmation */}
      <Dialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{removeTarget}</strong> from this team?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget)}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TeamDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-px w-full" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
