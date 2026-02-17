'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function CreateTeamDialog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<'closed' | 'secret'>('closed');

  const mutation = useMutation({
    mutationFn: () => api.createTeam({ name, description: description || undefined, privacy }),
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setOpen(false);
      resetForm();
      toast({ title: 'Team created', description: `"${team.name}" has been created.` });
    },
    onError: (err) => {
      toast({ title: 'Failed to create team', description: err.message, variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setPrivacy('closed');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>Create Team</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              placeholder="e.g. Frontend"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-description">Description</Label>
            <Textarea
              id="team-description"
              placeholder="What does this team do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Privacy</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={privacy === 'closed' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPrivacy('closed')}
              >
                Visible
              </Button>
              <Button
                type="button"
                variant={privacy === 'secret' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPrivacy('secret')}
              >
                Secret
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
