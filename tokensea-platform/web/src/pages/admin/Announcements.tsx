import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Megaphone, Pin } from "lucide-react"

interface Announcement {
  id: string
  title: string
  content: string
  type: string
  pinned: boolean
  status: string
  createdAt: string
  updatedAt: string
}

interface AnnouncementList {
  items: Announcement[]
  total: number
}

export function AdminAnnouncements() {
  const { t } = useTranslation()
  const [data, setData] = useState<AnnouncementList>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [form, setForm] = useState({ title: "", content: "", type: "info", pinned: false })

  const fetch = useCallback(() => {
    setLoading(true)
    api.listAnnouncements(page)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => { fetch() }, [fetch])

  const handleCreate = async () => {
    await api.createAnnouncement(form)
    setShowCreate(false)
    setForm({ title: "", content: "", type: "info", pinned: false })
    fetch()
  }

  const handleEditOpen = (item: Announcement) => {
    setEditing(item)
    setForm({ title: item.title, content: item.content, type: item.type, pinned: item.pinned })
    setShowEdit(true)
  }

  const handleEditSave = async () => {
    if (!editing) return
    await api.updateAnnouncement(editing.id, form)
    setShowEdit(false)
    setEditing(null)
    fetch()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return
    await api.deleteAnnouncement(id)
    fetch()
  }

  const typeColor: Record<string, string> = {
    info: "bg-blue-500",
    warning: "bg-amber-500",
    maintenance: "bg-red-500",
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.announcements.title")}</h1>
          <p className="text-muted-foreground">{t("admin.announcements.subtitle")}</p>
        </div>
        <Button onClick={() => { setForm({ title: "", content: "", type: "info", pinned: false }); setShowCreate(true) }}>
          <Megaphone className="mr-2 h-4 w-4" />
          {t("admin.announcements.create")}
        </Button>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.announcements.createTitle")}</DialogTitle>
            <DialogDescription>{t("admin.announcements.createDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("admin.announcements.title")}</Label>
              <Input value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.announcements.content")}</Label>
              <Textarea value={form.content} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, content: e.target.value })} rows={4} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.announcements.type")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.pinned} onCheckedChange={(v) => setForm({ ...form, pinned: v })} />
              <Label className="flex items-center gap-1"><Pin className="h-3 w-3" /> {t("admin.announcements.pinned")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate} disabled={!form.title || !form.content}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.announcements.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("admin.announcements.title")}</Label>
              <Input value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.announcements.content")}</Label>
              <Textarea value={form.content} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, content: e.target.value })} rows={4} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.announcements.type")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.pinned} onCheckedChange={(v) => setForm({ ...form, pinned: v })} />
              <Label className="flex items-center gap-1"><Pin className="h-3 w-3" /> {t("admin.announcements.pinned")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleEditSave}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.announcements.title")}</TableHead>
                <TableHead>{t("admin.announcements.type")}</TableHead>
                <TableHead>{t("admin.announcements.pinned")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.created")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-20" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    {t("common.noData")}
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium max-w-[300px] truncate">{item.title}</TableCell>
                    <TableCell>
                      <Badge className={`${typeColor[item.type] || "bg-slate-500"} text-white`}>
                        {item.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.pinned && <Pin className="h-4 w-4 text-primary" />}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "active" ? "success" : "secondary"}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={() => handleEditOpen(item)}>
                          {t("common.edit")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(item.id)}>
                          {t("common.delete")}
                        </Button>
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
  )
}
