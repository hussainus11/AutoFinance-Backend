import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { serialize } from "../serialize.js";
import { notifyAdminUsers } from "../services/notifications.js";
import { getRequestContext } from "../context.js";

export const vehiclesRouter = Router();

const vehicleImageSchema = z.object({
  fileUrl: z.string().min(1),
  fileName: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  sortOrder: z.number().int().optional().default(0)
});

const vehicleBody = z.object({
  vin: z.string().optional().nullable(),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  trim: z.string().optional().nullable(),
  listPrice: z.string().or(z.number()),
  status: z.enum(["AVAILABLE", "RESERVED", "SOLD", "FINANCED", "REPOSSESSED", "DISPOSED"]).optional(),
  vehicleCondition: z
    .enum(["NEW", "USED", "CERTIFIED_PRE_OWNED", "DEMO", "OTHER"])
    .optional()
    .nullable(),
  vehicleTypeId: z.string().uuid().optional().nullable(),
  stockNumber: z.string().optional().nullable(),
  exteriorColor: z.string().optional().nullable(),
  interiorColor: z.string().optional().nullable(),
  bodyStyle: z.string().optional().nullable(),
  odometerKm: z.number().int().min(0).optional().nullable(),
  fuelType: z.string().optional().nullable(),
  transmission: z.string().optional().nullable(),
  drivetrain: z.string().optional().nullable(),
  engineDescription: z.string().optional().nullable(),
  doors: z.number().int().min(1).max(10).optional().nullable(),
  seats: z.number().int().min(1).max(20).optional().nullable(),
  registrationNumber: z.string().optional().nullable(),
  registrationRegion: z.string().optional().nullable(),
  purchaseDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  previousOwnerId: z.string().uuid().optional().nullable(),
  images: z.array(vehicleImageSchema).optional().default([])
});

const vehicleCreate = vehicleBody;
const vehicleUpdate = vehicleBody.partial();

const previousOwnerInclude = {
  phones: { orderBy: { isPrimary: "desc" as const } },
  emails: { orderBy: { isPrimary: "desc" as const } },
  addresses: { orderBy: { isPrimary: "desc" as const }, take: 3 },
  documents: { orderBy: { createdAt: "desc" as const }, take: 8 }
} satisfies Prisma.PartnerInclude;

const vehicleInclude = {
  previousOwner: { include: previousOwnerInclude },
  images: { orderBy: { sortOrder: "asc" as const } },
  vehicleType: true
} satisfies Prisma.VehicleInclude;

function vehicleCreateData(
  body: z.infer<typeof vehicleCreate>
): any {
  const { images, listPrice, previousOwnerId, ...rest } = body;
  const lp = new Prisma.Decimal(String(listPrice));
  return {
    vin: rest.vin ?? undefined,
    make: rest.make,
    model: rest.model,
    year: rest.year,
    trim: rest.trim ?? undefined,
    listPrice: lp,
    status: rest.status,
    vehicleCondition: rest.vehicleCondition ?? undefined,
    vehicleType: rest.vehicleTypeId ? { connect: { id: rest.vehicleTypeId } } : undefined,
    stockNumber: rest.stockNumber ?? undefined,
    exteriorColor: rest.exteriorColor ?? undefined,
    interiorColor: rest.interiorColor ?? undefined,
    bodyStyle: rest.bodyStyle ?? undefined,
    odometerKm: rest.odometerKm ?? undefined,
    fuelType: rest.fuelType ?? undefined,
    transmission: rest.transmission ?? undefined,
    drivetrain: rest.drivetrain ?? undefined,
    engineDescription: rest.engineDescription ?? undefined,
    doors: rest.doors ?? undefined,
    seats: rest.seats ?? undefined,
    registrationNumber: rest.registrationNumber ?? undefined,
    registrationRegion: rest.registrationRegion ?? undefined,
    purchaseDate: rest.purchaseDate ?? undefined,
    notes: rest.notes ?? undefined,
    previousOwner: previousOwnerId
      ? { connect: { id: previousOwnerId } }
      : undefined,
    images:
      images && images.length > 0
        ? {
            create: images.map((img, i) => ({
              id: randomUUID(),
              fileUrl: img.fileUrl,
              fileName: img.fileName ?? null,
              mimeType: img.mimeType ?? null,
              sortOrder: img.sortOrder ?? i
            }))
          }
        : undefined
  };
}

/** Vehicles — inventory with specs, images, optional previous-owner partner. */
function buildVehicleSearchWhere(q: string): Prisma.VehicleWhereInput {
  const trimmed = q.trim();
  const or: Prisma.VehicleWhereInput[] = [
    { make: { contains: trimmed, mode: "insensitive" } },
    { model: { contains: trimmed, mode: "insensitive" } },
    { trim: { contains: trimmed, mode: "insensitive" } },
    { vin: { contains: trimmed, mode: "insensitive" } },
    { stockNumber: { contains: trimmed, mode: "insensitive" } },
    { registrationNumber: { contains: trimmed, mode: "insensitive" } },
    { notes: { contains: trimmed, mode: "insensitive" } },
    { previousOwner: { is: { displayName: { contains: trimmed, mode: "insensitive" } } } }
  ];
  const yearNum = Number.parseInt(trimmed, 10);
  if (Number.isFinite(yearNum) && yearNum >= 1900 && yearNum <= 2100) {
    or.push({ year: yearNum });
  }
  return { OR: or };
}

vehiclesRouter.get("/vehicles", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const rows = await prisma.vehicle.findMany({
      where: q ? buildVehicleSearchWhere(q) : undefined,
      orderBy: { createdAt: "desc" },
      include: vehicleInclude
    });
    res.json(serialize(rows));
  } catch (e) {
    next(e);
  }
});

vehiclesRouter.get("/vehicles/:id", async (req, res, next) => {
  try {
    const row = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: vehicleInclude
    });
    if (!row) return res.status(404).json({ error: "Vehicle not found" });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

vehiclesRouter.post("/vehicles", async (req, res, next) => {
  try {
    const body = vehicleCreate.parse(req.body);
    const tenantCompanyId = getRequestContext()?.companyId;
    const tenantBranchId = getRequestContext()?.branchId ?? null;
    const baseData = vehicleCreateData(body);
    const data =
      tenantCompanyId
        ? {
            ...baseData,
            company: { connect: { id: tenantCompanyId } },
            ...(tenantBranchId ? { branch: { connect: { id: tenantBranchId } } } : {}),
            ...(baseData.images?.create
              ? {
                  images: {
                    create: baseData.images.create.map((img: any) => ({
                      ...img,
                      company: { connect: { id: tenantCompanyId } },
                      ...(tenantBranchId ? { branch: { connect: { id: tenantBranchId } } } : {})
                    }))
                  }
                }
              : {})
          }
        : baseData;
    const row = await prisma.vehicle.create({
      data,
      include: vehicleInclude
    });
    await notifyAdminUsers({
      type: "VEHICLE_CREATED",
      title: "Vehicle added",
      message: `${row.make} ${row.model} (${row.year})`,
      href: "/dashboard/autofinance/vehicles"
    });
    res.status(201).json(serialize(row));
  } catch (e) {
    next(e);
  }
});

vehiclesRouter.patch("/vehicles/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = vehicleUpdate.parse(req.body);
    const { images } = body;

    const row = await prisma.$transaction(async (tx) => {
      const {
        images: _i,
        listPrice,
        make,
        model,
        year,
        trim,
        vin,
        status,
        vehicleCondition,
        vehicleTypeId,
        stockNumber,
        exteriorColor,
        interiorColor,
        bodyStyle,
        odometerKm,
        fuelType,
        transmission,
        drivetrain,
        engineDescription,
        doors,
        seats,
        registrationNumber,
        registrationRegion,
        purchaseDate,
        notes,
        previousOwnerId
      } = body;

      const data: Prisma.VehicleUpdateInput = {};
      if (vin !== undefined) data.vin = vin;
      if (make !== undefined) data.make = make;
      if (model !== undefined) data.model = model;
      if (year !== undefined) data.year = year;
      if (trim !== undefined) data.trim = trim;
      if (listPrice !== undefined) data.listPrice = new Prisma.Decimal(String(listPrice));
      if (status !== undefined) data.status = status;
      if (vehicleCondition !== undefined) data.vehicleCondition = vehicleCondition;
      if (vehicleTypeId !== undefined) {
        data.vehicleType = vehicleTypeId ? { connect: { id: vehicleTypeId } } : { disconnect: true };
      }
      if (stockNumber !== undefined) data.stockNumber = stockNumber;
      if (exteriorColor !== undefined) data.exteriorColor = exteriorColor;
      if (interiorColor !== undefined) data.interiorColor = interiorColor;
      if (bodyStyle !== undefined) data.bodyStyle = bodyStyle;
      if (odometerKm !== undefined) data.odometerKm = odometerKm;
      if (fuelType !== undefined) data.fuelType = fuelType;
      if (transmission !== undefined) data.transmission = transmission;
      if (drivetrain !== undefined) data.drivetrain = drivetrain;
      if (engineDescription !== undefined) data.engineDescription = engineDescription;
      if (doors !== undefined) data.doors = doors;
      if (seats !== undefined) data.seats = seats;
      if (registrationNumber !== undefined) data.registrationNumber = registrationNumber;
      if (registrationRegion !== undefined) data.registrationRegion = registrationRegion;
      if (purchaseDate !== undefined) data.purchaseDate = purchaseDate;
      if (notes !== undefined) data.notes = notes;
      if (previousOwnerId !== undefined) {
        data.previousOwner = previousOwnerId
          ? { connect: { id: previousOwnerId } }
          : { disconnect: true };
      }

      if (Object.keys(data).length > 0) {
        await tx.vehicle.update({ where: { id }, data });
      }

      if (images !== undefined) {
        await tx.vehicleImage.deleteMany({ where: { vehicleId: id } });
        if (images.length > 0) {
          await tx.vehicleImage.createMany({
            data: images.map((img, i) => ({
              id: randomUUID(),
              vehicleId: id,
              fileUrl: img.fileUrl,
              fileName: img.fileName ?? null,
              mimeType: img.mimeType ?? null,
              sortOrder: img.sortOrder ?? i
            }))
          });
        }
      }

      return tx.vehicle.findUniqueOrThrow({
        where: { id },
        include: vehicleInclude
      });
    });

    await notifyAdminUsers({
      type: "VEHICLE_UPDATED",
      title: "Vehicle updated",
      message: `${row.make} ${row.model} (${row.year})`,
      href: "/dashboard/autofinance/vehicles"
    });
    res.json(serialize(row));
  } catch (e) {
    next(e);
  }
});

vehiclesRouter.delete("/vehicles/:id", async (req, res, next) => {
  try {
    await prisma.vehicle.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") {
        res.status(404).json({ error: "Vehicle not found" });
        return;
      }
      if (e.code === "P2003" || e.code === "P2014") {
        res.status(409).json({
          error:
            "This vehicle cannot be deleted because it is linked to a contract or other records."
        });
        return;
      }
    }
    next(e);
  }
});
