import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { formatQuota, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyRound } from "lucide-react";

interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
  status: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  createdAt: string;
}

interface UserList {
  items: User[];
  total: number;
}

export function AdminUsers() {
  const { t } = useTranslation();
  const [data, setData] = useState<UserList>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [createForm, setCreateForm] = useState({ username: "", password: "", email: "", name: "", role: "user", quota: "" });
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "user", status: "active", quota: "" });

  const [showResetPw, setShowResetPw] = useState(false);
  const [resetPwUser, setResetPwUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resettingPw, setResettingPw] = useState(false);

  const fetch = useCallback(() => {
    setLoading(true);
    api.listUsers(page, search || undefined)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async () => {
    await api.createUser({ ...createForm, quota: createForm.quota ? Number(createForm.quota) * 100 : undefined });
    setShowCreate(false);
    setCreateForm({ username: "", password: "", email: "", name: "", role: "user", quota: "" });
    fetch();
  };

  const handleEditOpen = (user: User) => {
    setEditingUser(user);
    setEditForm({
      name: user.name || "",
      email: user.email || "",
      role: user.role,
      status: user.status,
      quota: user.quota ? String(Math.round(user.quota / 100)) : "",
    });
    setShowEdit(true);
  };

  const handleEditSave = async () => {
    if (!editingUser) return;
    const body: Record<string, any> = {};
    if (editForm.name !== (editingUser.name || "")) body.name = editForm.name;
    if (editForm.email !== (editingUser.email || "")) body.email = editForm.email;
    if (editForm.role !== editingUser.role) body.role = editForm.role;
    if (editForm.status !== editingUser.status) body.status = editForm.status;
    if (editForm.quota !== "" && Number(editForm.quota) * 100 !== editingUser.quota) {
      body.quota = Number(editForm.quota) * 100;
    }
    await api.updateUser(editingUser.id, body);
    setShowEdit(false);
    setEditingUser(null);
    fetch();
  };

  const handleResetPassword = (user: User) => {
    setResetPwUser(user);
    setNewPassword("");
    setShowResetPw(true);
  };

  const handleResetPwConfirm = async () => {
    if (!resetPwUser || !newPassword) return;
    setResettingPw(true);
    try {
      await api.resetUserPassword(resetPwUser.id, newPassword);
      setShowResetPw(false);
      setResetPwUser(null);
      setNewPassword("");
    } catch (err: any) {
      alert(err.message);
    } finally {
      setResettingPw(false);
    }
  };

  const toggleStatus = async (id: string, status: string) => {
    await api.updateUser(id, { status: status === "active" ? "disabled" : "active" });
    fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await api.deleteUser(id);
    fetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.users.title")}</h1>
          <p className="text-muted-foreground">{t("admin.users.subtitle")}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>{t("admin.users.createUser")}</Button>
      </div>

      <div className="max-w-sm">
        <Input
          placeholder={t("admin.users.searchUsers")}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.users.createUserTitle")}</DialogTitle>
            <DialogDescription>{t("admin.users.createUserDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("admin.users.username")}</Label>
              <Input value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Password</Label>
              <Input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.users.email")}</Label>
              <Input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.users.displayName")}</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.users.role")}</Label>
              <Select value={createForm.role} onValueChange={(v) => setCreateForm({ ...createForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.users.quotaCents")}</Label>
              <Input type="number" value={createForm.quota} onChange={(e) => setCreateForm({ ...createForm, quota: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.users.editUserTitle")}</DialogTitle>
            <DialogDescription>{t("admin.users.editUserDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("admin.users.displayName")}</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.users.email")}</Label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.users.role")}</Label>
              <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("common.status")}</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("common.active")}</SelectItem>
                  <SelectItem value="disabled">{t("common.disabled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.users.quotaCents")}</Label>
              <Input type="number" value={editForm.quota} onChange={(e) => setEditForm({ ...editForm, quota: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleEditSave}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={showResetPw} onOpenChange={setShowResetPw}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.users.resetPassword")}</DialogTitle>
            <DialogDescription>
              Set a new password for {resetPwUser?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetPw(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleResetPwConfirm} disabled={resettingPw || newPassword.length < 8}>
              {resettingPw ? t("common.loading") : t("admin.users.resetPassword")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.users.username")}</TableHead>
                <TableHead>{t("admin.users.email")}</TableHead>
                <TableHead>{t("admin.users.role")}</TableHead>
                <TableHead>{t("admin.users.status")}</TableHead>
                <TableHead>{t("admin.users.quota")}</TableHead>
                <TableHead>{t("admin.users.requests")}</TableHead>
                <TableHead>{t("common.created")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-20" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    {t("common.noData")}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email || "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={u.status === "active" ? "success" : "destructive"}>
                        {u.status === "active" ? t("common.active") : t("common.disabled")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatQuota(u.usedQuota)} / {formatQuota(u.quota)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatNumber(Number(u.requestCount))}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditOpen(u)}
                        >
                          {t("common.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          title={t("admin.users.resetPassword")}
                          onClick={() => handleResetPassword(u)}
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant={u.status === "active" ? "outline" : "default"}
                          onClick={() => toggleStatus(u.id, u.status)}
                        >
                          {u.status === "active" ? t("common.disable") : t("common.enable")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(u.id)}>{t("common.delete")}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("common.prev")}</Button>
        <span className="text-sm text-muted-foreground px-2">{page} ({data.total})</span>
        <Button variant="outline" size="sm" disabled={data.items.length < 20} onClick={() => setPage(page + 1)}>{t("common.next")}</Button>
      </div>
    </div>
  );
}
