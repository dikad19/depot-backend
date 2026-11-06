import express from "express";
import { prisma } from "../lib/prisma";

const app = express();
app.use(express.json());

app.get("/api/products", async (req, res) => {
  const products = await prisma.product.findMany();
  res.json(products);
});
