import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { AuthGuard, CoreModule } from './common/core';
import { AuthController } from './modules/auth/auth.controller';
import { AgentsController } from './modules/agents/agents.controller';
import { OrdersController } from './modules/orders/orders.controller';
import { PointsController } from './modules/points/points.controller';
import { PointsService } from './modules/points/points.service';
import { ApprovalsService } from './modules/points/approvals.service';
import { GiftsController } from './modules/gifts/gifts.controller';
import { AgentAppController } from './modules/app/app.controller';
import { AdminController } from './modules/admin/admin.controller';
import { SchedulerService } from './modules/admin/scheduler.service';
import { EngageController } from './modules/engage/engage.controller';
import { FilesController } from './modules/files/files.controller';

/** Bản build web (apps/web/dist) được phục vụ cùng cổng khi có — một tiến trình cho demo/deploy đơn giản. */
const WEB_DIST = process.env.WEB_DIST ?? path.resolve(__dirname, '../../web/dist');
const statics = fs.existsSync(WEB_DIST) ? [ServeStaticModule.forRoot({ rootPath: WEB_DIST, exclude: ['/api/{*path}'] })] : [];

@Module({
  imports: [CoreModule, ...statics],
  controllers: [AuthController, AgentsController, OrdersController, PointsController, GiftsController, AgentAppController, AdminController, EngageController, FilesController],
  // OrdersController cũng là provider để SchedulerService gọi runSync (đồng bộ KiotViet theo lịch)
  providers: [PointsService, ApprovalsService, SchedulerService, OrdersController, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
