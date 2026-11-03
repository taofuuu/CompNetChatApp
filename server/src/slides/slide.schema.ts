import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** One page of a Lesson's slide deck, as text. Written only by the ingest script, never by Users. */
@Schema()
export class Slide {
  /** The Lesson's number, from its PDF's file name. */
  @Prop({ required: true })
  lesson: number;

  @Prop({ required: true })
  lessonName: string;

  /** The page number in the Lesson's PDF, from 1. */
  @Prop({ required: true })
  slide: number;

  /** The page's text with its whitespace collapsed. May be empty for a page that is only a picture. */
  @Prop({ default: '' })
  text: string;
}

export const SlideSchema = SchemaFactory.createForClass(Slide);
SlideSchema.index({ lesson: 1, slide: 1 }, { unique: true });
