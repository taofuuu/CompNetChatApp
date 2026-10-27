import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Group, GroupSchema } from './group.schema';
import { GroupsGateway } from './groups.gateway';
import { GroupsService } from './groups.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Group.name, schema: GroupSchema }])],
  providers: [GroupsGateway, GroupsService],
  // Group Messages (#11) need to check membership.
  exports: [GroupsService],
})
export class GroupsModule {}
