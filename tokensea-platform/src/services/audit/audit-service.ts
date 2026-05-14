import type { PrismaClient } from "@prisma/client";
import { LogService } from "../log/log-service.js";

export class AuditService {
  private logService: LogService;

  constructor(private prisma: PrismaClient) {
    this.logService = new LogService(prisma);
  }

  async log(data: {
    actorId?: bigint;
    actorName?: string;
    action: string;
    targetType: string;
    targetId?: string;
    detail?: any;
    ip?: string;
  }) {
    return this.logService.writeAuditLog(data);
  }

  async list(opts?: { page?: number; pageSize?: number; actorId?: bigint; action?: string }) {
    return this.logService.listAuditLogs(opts);
  }
}
