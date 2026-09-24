import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/password.js";
import { ensureUniqueCompanySlug } from "../src/services/company-slug.js";

const prisma = new PrismaClient();

const PLATFORM_COMPANY_NAME = "Auto Finance";
const PLATFORM_ADMIN_EMAIL = "saddam.hussainus11@gmail.com";
const PLATFORM_ADMIN_PASSWORD = "XXXXxxxx1412@";

async function main() {
  let company = await prisma.company.findUnique({ where: { name: PLATFORM_COMPANY_NAME } });
  if (!company) {
    const slug = await ensureUniqueCompanySlug(prisma as any, PLATFORM_COMPANY_NAME);
    company = await prisma.company.create({
      data: {
        name: PLATFORM_COMPANY_NAME,
        slug,
        isActive: true,
        isPlatformOwner: true
      } as any
    });
  } else if (!(company as any).isPlatformOwner) {
    company = await prisma.company.update({
      where: { id: company.id },
      data: { isPlatformOwner: true } as any
    });
  }

  await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      name: "Saddam Hussain",
      role: "ADMIN",
      passwordHash: hashPassword(PLATFORM_ADMIN_PASSWORD),
      company: { connect: { id: company.id } }
    },
    update: {
      role: "ADMIN",
      passwordHash: hashPassword(PLATFORM_ADMIN_PASSWORD),
      company: { connect: { id: company.id } }
    }
  });

  console.log("Seed completed.", { company: company.name, slug: (company as any).slug, admin: PLATFORM_ADMIN_EMAIL });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
