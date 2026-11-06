import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { ah, bad, parseId } from "../http";

export const productsRouter = Router();

const ci = "insensitive" as const;
const SIZE_TYPES = ["NONE", "SHOE", "CLOTHING"] as const;
const SORTS = {
  terbaru: { createdAt: "desc" },
  terlaris: { soldCount: "desc" },
  termurah: { price: "asc" },
  termahal: { price: "desc" },
} as const;

const str = (v: unknown) =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const int = (v: unknown, min = 0) =>
  typeof v === "number" && Number.isInteger(v) && v >= min ? v : null;

// Hanya voucher yang sedang berlaku
const activeVouchers = () => {
  const now = new Date();
  return { where: { startsAt: { lte: now }, endsAt: { gte: now } } };
};

// GET /api/products?q=&category=&promo=1&sort=&page=&limit=
productsRouter.get(
  "/",
  ah(async (req, res) => {
    const q = str(req.query.q);
    const category = str(req.query.category);
    const sortKey =
      typeof req.query.sort === "string" && req.query.sort in SORTS
        ? (req.query.sort as keyof typeof SORTS)
        : "terbaru";
    const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
    const limit = Math.min(
      40,
      Math.max(1, Math.trunc(Number(req.query.limit)) || 20),
    );

    const where = {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: ci } },
              { category: { name: { contains: q, mode: ci } } },
            ],
          }
        : {}),
      ...(category ? { category: { slug: category } } : {}),
      ...(req.query.promo === "1" ? { originalPrice: { not: null } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: SORTS[sortKey],
        skip: (page - 1) * limit,
        take: limit,
        include: { seller: true, category: true, vouchers: activeVouchers() },
      }),
      prisma.product.count({ where }),
    ]);
    res.json({ items, total, page, limit });
  }),
);

// GET /api/products/:id -> { product, reviews, ratingBreakdown }
productsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return bad(res, "id tidak valid");

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: "asc" } },
        variants: { orderBy: { id: "asc" } },
        specs: { orderBy: { position: "asc" } },
        sizeGuide: true,
        seller: true,
        category: true,
        vouchers: activeVouchers(),
      },
    });
    if (!product) {
      res.status(404).json({ message: "produk tidak ditemukan" });
      return;
    }

    const [reviews, groups] = await Promise.all([
      prisma.review.findMany({
        where: { productId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
      }),
      prisma.review.groupBy({
        by: ["rating"],
        where: { productId: id },
        _count: true,
      }),
    ]);
    const ratingBreakdown = Object.fromEntries(
      groups.map((g) => [g.rating, g._count]),
    );
    res.json({ product, reviews, ratingBreakdown });
  }),
);

// GET /api/products/:id/reviews?star=&cursor=&limit=
productsRouter.get(
  "/:id/reviews",
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return bad(res, "id tidak valid");
    const star = Math.trunc(Number(req.query.star));
    const cursor = parseId(req.query.cursor);
    const limit = Math.min(
      30,
      Math.max(1, Math.trunc(Number(req.query.limit)) || 10),
    );

    const rows = await prisma.review.findMany({
      where: {
        productId: id,
        ...(star >= 1 && star <= 5 ? { rating: star } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    res.json({
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    });
  }),
);

// POST /api/products
productsRouter.post(
  "/",
  ah(async (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name);
    const price = int(b.price);
    const stock = int(b.stock);
    if (!name) return bad(res, "name harus teks dan tidak boleh kosong");
    if (price === null)
      return bad(res, "price harus bilangan bulat, minimal 0");
    if (stock === null)
      return bad(res, "stock harus bilangan bulat, minimal 0");

    const originalPrice = b.originalPrice == null ? null : int(b.originalPrice);
    if (
      b.originalPrice != null &&
      (originalPrice === null || originalPrice < price)
    ) {
      return bad(
        res,
        "originalPrice harus bilangan bulat dan tidak lebih kecil dari price",
      );
    }
    const etaMinDays = int(b.etaMinDays) ?? 2;
    const etaMaxDays = int(b.etaMaxDays) ?? 4;
    if (etaMinDays > etaMaxDays)
      return bad(res, "etaMinDays tidak boleh lebih besar dari etaMaxDays");

    const categoryId = b.categoryId == null ? null : int(b.categoryId, 1);
    const sellerId = b.sellerId == null ? null : int(b.sellerId, 1);
    if (
      (b.categoryId != null && !categoryId) ||
      (b.sellerId != null && !sellerId)
    ) {
      return bad(res, "categoryId dan sellerId harus bilangan bulat positif");
    }

    const images = (Array.isArray(b.images) ? b.images : [])
      .filter((i: any) => str(i?.url))
      .map((i: any, n: number) => ({
        url: i.url.trim(),
        alt: str(i.alt),
        position: n,
      }));
    const variants = (Array.isArray(b.variants) ? b.variants : [])
      .filter((v: any) => str(v?.label))
      .map((v: any) => ({
        label: v.label.trim(),
        stock: int(v.stock) ?? 0,
        price: v.price == null ? null : int(v.price),
      }));
    const specs = (Array.isArray(b.specs) ? b.specs : [])
      .filter((s: any) => str(s?.label) && str(s?.value))
      .map((s: any, n: number) => ({
        label: s.label.trim(),
        value: s.value.trim(),
        position: n,
      }));

    const product = await prisma.product.create({
      data: {
        name,
        price,
        stock,
        originalPrice,
        thumbnailUrl: str(b.thumbnailUrl),
        description: str(b.description),
        sizeType: SIZE_TYPES.find((t) => t === b.sizeType) ?? "NONE",
        freeShipping: b.freeShipping === true,
        instant: b.instant === true,
        etaMinDays,
        etaMaxDays,
        categoryId,
        sellerId,
        images: { create: images },
        variants: { create: variants },
        specs: { create: specs },
      },
      include: { images: true, variants: true, specs: true },
    });
    res.status(201).json(product);
  }),
);

// POST /api/products/:id/reviews
// Menyimpan ulasan sekaligus memperbarui ringkasan rating di produk (satu transaksi).
productsRouter.post(
  "/:id/reviews",
  ah(async (req, res) => {
    const productId = parseId(req.params.id);
    if (!productId) return bad(res, "id tidak valid");
    const b = req.body ?? {};
    const userName = str(b.userName);
    const rating = int(b.rating, 1);
    if (!userName) return bad(res, "userName wajib diisi");
    if (rating === null || rating > 5)
      return bad(res, "rating harus bilangan bulat 1 sampai 5");
    const comment = str(b.comment);
    if (comment && comment.length > 1000)
      return bad(res, "comment maksimal 1000 karakter");
    const photos = (Array.isArray(b.photos) ? b.photos : [])
      .filter((p: unknown) => str(p))
      .slice(0, 5);

    const exists = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!exists) {
      res.status(404).json({ message: "produk tidak ditemukan" });
      return;
    }

    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          productId,
          userName,
          rating,
          comment,
          variantLabel: str(b.variantLabel),
          photos,
        },
      });
      const agg = await tx.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: true,
      });
      await tx.product.update({
        where: { id: productId },
        data: {
          rating: Math.round((agg._avg.rating ?? 0) * 10) / 10,
          ratingCount: agg._count,
        },
      });
      return created;
    });
    res.status(201).json(review);
  }),
);
