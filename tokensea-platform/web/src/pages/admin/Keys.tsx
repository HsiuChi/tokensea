import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { formatQuota, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface Token {
  id: string;
  keyPrefix: string;
  userId: string;
  name: string;
  status: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  createdAt: string;
}

interface TokenList {
  items: Token[];
  total: number;
}

interface KeyGroup {
  id: string;
  name: string;
  userId: string;
  models?: string[] | null;
  quota: string;
  usedQuota: string;
  priority: number;
  _count?: { apiKeys: number };
}

interface GroupForm {
  name: string;
  userId: string;
  models: string;
  quota: string;
  priority: string;
}

const emptyGroupForm: GroupForm = { name: "", userId: "", models: "", quota: "-1", priority: "0" };

export function AdminKeys() {
  const { t } = useTranslation();
  const [data, setData] = useState<TokenList>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Key groups
  const [groups, setGroups] = useState<KeyGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>({ ...emptyGroupForm });
  const [users, setUsers] = useState<Array<{ id: string; username: string }>>([]);
  const [savingGroup, setSavingGroup] = useState(false);

  const fetch = useCallback(() => {
    setLoading(true);
    api.listTokens(page)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  const fetchGroups = useCallback(() => {
    setGroupsLoading(true);
    api.listKeyGroups()
      .then((r: any) => setGroups(r.items || r || []))
      .catch(console.error)
      .finally(() => setGroupsLoading(false));
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const openGroupDialog = async (g?: KeyGroup) => {
    setEditingGroupId(g?.id ?? null);
    setGroupForm(g ? {
      name: g.name || "",
      userId: g.userId || "",
      models: g.models?.join(", ") || "",
      quota: String(g.quota ?? "-1"),
      priority: String(g.priority ?? 0),
    } : { ...emptyGroupForm });
    setShowGroupDialog(true);
    if (users.length === 0) {
      try {
        const r = await api.listUsers(1);
        setUsers(r.items || []);
      } catch (e) { console.error(e); }
    }
  };

  const handleSaveGroup = async () => {
    setSavingGroup(true);
    try {
      const body: any = {
        name: groupForm.name,
        priority: Number(groupForm.priority) || 0,
        quota: BigInt(groupForm.quota || "-1"),
      };
      if (groupForm.models) body.models = groupForm.models.split(",").map((s) => s.trim()).filter(Boolean);
      if (editingGroupId) {
        await api.updateKeyGroup(editingGroupId, body);
      } else {
        if (!groupForm.userId) { alert(t("admin.keyGroups.userRequired")); setSavingGroup(false); return; }
        body.userId = BigInt(groupForm.userId);
        await api.createKeyGroup(body);
      }
      setShowGroupDialog(false);
      setEditingGroupId(null);
      fetchGroups();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm(t("admin.keyGroups.deleteGroup"))) return;
    try {
      await api.deleteKeyGroup(id);
      fetchGroups();
    } catch (e: any) { alert(e.message); }
  };

  const toggleStatus = async (id: string, status: string) => {
    await api.updateToken(id, { status: status === "active" ? "disabled" : "active" });
    fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await api.deleteToken(id);
    fetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.keys.title")}</h1>
          <p className="text-muted-foreground">{t("admin.keys.totalKeys", { count: data.total })}</p>
        </div>
      </div>

      {/* Key Groups */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("admin.keyGroups.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("admin.keyGroups.subtitle")}</p>
            </div>
            <Button size="sm" onClick={() => openGroupDialog()}>
              <Plus className="mr-1 h-4 w-4" /> {t("admin.keyGroups.addGroup")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.keys.name")}</TableHead>
                <TableHead>{t("admin.keyGroups.owner")}</TableHead>
                <TableHead>{t("admin.keyGroups.priority")}</TableHead>
                <TableHead>{t("admin.keys.quota")}</TableHead>
                <TableHead>{t("admin.keys.models")}</TableHead>
                <TableHead>{t("admin.keyGroups.keyCount")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupsLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">{t("admin.keyGroups.noGroups")}</TableCell>
                </TableRow>
              ) : (
                groups.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{users.find((u) => u.id === g.userId)?.username || `${g.userId?.slice(0, 8)}...`}</TableCell>
                    <TableCell className="text-muted-foreground">{g.priority}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {String(g.quota) === "-1" ? "∞" : `${formatQuota(g.usedQuota)} / ${formatQuota(g.quota)}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {g.models?.length ? g.models.join(", ") : t("admin.keyGroups.allModels")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{g._count?.apiKeys ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openGroupDialog(g)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteGroup(g.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Group create/edit dialog */}
      <Dialog open={showGroupDialog} onOpenChange={(open) => { if (!open) { setShowGroupDialog(false); setEditingGroupId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroupId ? t("admin.keyGroups.editGroup") : t("admin.keyGroups.addGroup")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("admin.keys.name")}</Label>
              <Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
            </div>
            {!editingGroupId && (
              <div className="space-y-2">
                <Label>{t("admin.keyGroups.owner")}</Label>
                <Select value={groupForm.userId} onValueChange={(v) => setGroupForm({ ...groupForm, userId: v })}>
                  <SelectTrigger><SelectValue placeholder={t("admin.keyGroups.selectUser")} /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("admin.keys.models")}</Label>
              <Input value={groupForm.models} onChange={(e) => setGroupForm({ ...groupForm, models: e.target.value })} placeholder={t("admin.keyGroups.allModels")} />
              <p className="text-xs text-muted-foreground">{t("admin.keyGroups.modelsHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("admin.keys.quota")}</Label>
                <Input type="number" value={groupForm.quota} onChange={(e) => setGroupForm({ ...groupForm, quota: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t("admin.keyGroups.quotaHint")}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("admin.keyGroups.priority")}</Label>
                <Input type="number" value={groupForm.priority} onChange={(e) => setGroupForm({ ...groupForm, priority: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowGroupDialog(false); setEditingGroupId(null); }}>{t("common.cancel")}</Button>
            <Button onClick={handleSaveGroup} disabled={savingGroup}>{savingGroup ? t("common.loading") : t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.keys.keyPrefix")}</TableHead>
                <TableHead>{t("admin.keys.user")}</TableHead>
                <TableHead>{t("admin.keys.name")}</TableHead>
                <TableHead>{t("admin.keys.status")}</TableHead>
                <TableHead>{t("admin.keys.quota")}</TableHead>
                <TableHead>{t("admin.keys.requests")}</TableHead>
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
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{t("common.noData")}</TableCell>
                </TableRow>
              ) : (
                data.items.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-mono font-medium">{k.keyPrefix}</TableCell>
                    <TableCell className="text-muted-foreground">{k.userId?.slice(0, 8)}...</TableCell>
                    <TableCell>{k.name}</TableCell>
                    <TableCell>
                      <Badge variant={k.status === "active" ? "success" : "destructive"}>
                        {k.status === "active" ? t("common.active") : t("common.disabled")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatQuota(k.usedQuota)} / {formatQuota(k.quota)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatNumber(Number(k.requestCount))}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(k.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant={k.status === "active" ? "outline" : "default"}
                          onClick={() => toggleStatus(k.id, k.status)}
                        >
                          {k.status === "active" ? t("common.disable") : t("common.enable")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(k.id)}>{t("common.delete")}</Button>
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
