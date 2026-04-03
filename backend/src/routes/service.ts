import { Router } from "express";
import { mockService } from "../controllers/service";

const router = Router();

router.get("/mock/:id", mockService);

export default router;