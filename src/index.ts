import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { productsRouter } from "./routes/products";
import { categoriesRouter } from "./routes/categories";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "endpoint tidak ditemukan" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { code?: string; type?: string };
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ message: "body bukan JSON yang valid" });
    return;
  }
  if (e?.code === "P2003") {
    res
      .status(400)
      .json({ message: "categoryId atau sellerId tidak ditemukan" });
    return;
  }
  console.error(err);
  res.status(500).json({ message: "terjadi kesalahan di server" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`backend jalan di port ${port}`);
});
