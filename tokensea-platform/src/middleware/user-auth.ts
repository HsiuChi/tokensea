import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from "fastify";
import { verifyToken } from "../lib/jwt.js";
import { unauthorized, forbidden } from "../lib/errors.js";

export function userAuthHook(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    done(unauthorized("Missing or invalid authorization header"));
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token, request.server.env.JWT_SECRET);
    request.userId = payload.userId;
    request.userRole = payload.role;
    done();
  } catch {
    done(unauthorized("Invalid or expired token"));
  }
}

export function adminAuthHook(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
  userAuthHook(request, _reply, (err) => {
    if (err) { done(err); return; }
    if (request.userRole !== "admin" && request.userRole !== "root") {
      done(forbidden("Admin access required"));
      return;
    }
    done();
  });
}

export function rootAuthHook(request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) {
  userAuthHook(request, _reply, (err) => {
    if (err) { done(err); return; }
    if (request.userRole !== "root") {
      done(forbidden("Root access required"));
      return;
    }
    done();
  });
}
