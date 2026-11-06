import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema()
export class Group {
  /** The name as its creator typed it. */
  @Prop({ required: true })
  name: string;

  /** The lowercase name: the unique index makes a second Group with the same name (ignoring case) impossible. */
  @Prop({ required: true, unique: true })
  key: string;

  /** Every Member's name, in the order they joined. */
  @Prop({ type: [String], required: true })
  members: string[];

  /** `members` in lowercase, so "already a Member" can be checked ignoring case inside the update itself. */
  @Prop({ type: [String], required: true })
  memberKeys: string[];

  /**
   * When each User kicked from this Group, by lowercase name, can join again. A deleted Group's blocks go with it.
   * shortcut: a block that ended stays here, one small entry per kicked User; remove it on Join if Groups ever collect many.
   */
  @Prop({ type: Map, of: Date })
  blockedUntil?: Record<string, Date>;
}

export const GroupSchema = SchemaFactory.createForClass(Group);
