import { Router } from "express";
import { prisma } from "../../prisma.js";
import { serialize } from "../../serialize.js";
import { getPortalContext } from "../../portal-context.js";

export const portalVehiclesRouter = Router();

/** Only ever returns vehicles where the caller is the previous owner — scoped explicitly by
 *  companyId + previousOwnerId, same defense-in-depth reasoning as the other portal routers.
 *  This is the thinnest of the three portal views: Vehicle.previousOwnerId is the only
 *  relation in the schema pointing at a PREVIOUS_OWNER partner. */
portalVehiclesRouter.get("/portal/vehicles", async (_req, res, next) => {
  try {
    const ctx = getPortalContext();
    if (!ctx) return res.status(401).json({ error: "Not authenticated" });

    const vehicles = await prisma.vehicle.findMany({
      where: { companyId: ctx.companyId, previousOwnerId: ctx.partnerId },
      select: {
        id: true,
        vin: true,
        make: true,
        model: true,
        year: true,
        condition: true,
        status: true,
        listPrice: true
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(serialize(vehicles));
  } catch (e) {
    next(e);
  }
});
