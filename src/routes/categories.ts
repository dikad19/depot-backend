import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { ah } from "../http";

export const categoriesRouter = Router();

categoriesRouter.get(
  "/",
  ah(async (_req, res) => {
    res.json(await prisma.category.findMany({ orderBy: { id: "asc" } }));
  }),
);
