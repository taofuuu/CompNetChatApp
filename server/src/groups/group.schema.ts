import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema()
export class Group {
  /** The name as its creator typed it. */
  @Prop({ required: true })
  name: string;

  /** The lowercase name: the unique index makes a second Group with the same name (ignoring case) impossible. */
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  creator: string;

  /** Every Member's name, in the order they joined: the creator first. */
  @Prop({ type: [String], required: true })
  members: string[];

  /** `members` in lowercase, so "already a Member" can be checked ignoring case inside the update itself. */
  @Prop({ type: [String], required: true })
  memberKeys: string[];
}

export const GroupSchema = SchemaFactory.createForClass(Group);
