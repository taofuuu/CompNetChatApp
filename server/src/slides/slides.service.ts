import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { SlideSearch } from './slide-search';
import { Slide } from './slide.schema';

/** Holds every Slide in memory, loaded once when the server starts. New Slides need a restart. */
@Injectable()
export class SlidesService implements OnModuleInit {
  private readonly logger = new Logger(SlidesService.name);
  private search = new SlideSearch([]);

  constructor(@InjectModel(Slide.name) private readonly slides: Model<Slide>) {}

  async onModuleInit() {
    this.search = new SlideSearch(await this.slides.find({}, { _id: 0, lesson: 1, lessonName: 1, slide: 1, text: 1 }).lean<Slide[]>());
    this.logger.log(`Loaded ${this.search.size} Slides.`);
  }

  /** Whether there are any Slides to search. None in development and tests, unless someone ran the ingest script. */
  get loaded() {
    return this.search.size > 0;
  }

  /** The `limit` Slides that best match `keywords`, best first. */
  top(keywords: string, limit: number) {
    return this.search.top(keywords, limit);
  }
}
