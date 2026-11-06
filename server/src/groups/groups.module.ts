import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Announcement, AnnouncementSchema } from './announcement.schema';
import { Group, GroupSchema } from './group.schema';
import { GroupsGateway } from './groups.gateway';
import { GroupsService } from './groups.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Group.name, schema: GroupSchema },
      { name: Announcement.name, schema: AnnouncementSchema },
    ]),
  ],
  providers: [GroupsGateway, GroupsService],
  // Group Messages (#11) need to check membership, and a Room's history needs its Announcements.
  exports: [GroupsService],
})
export class GroupsModule {}
