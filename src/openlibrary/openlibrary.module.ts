import { Module } from '@nestjs/common';
import { OpenLibraryService } from './openlibrary.service';

@Module({
  providers: [OpenLibraryService],
  exports: [OpenLibraryService],
})
export class OpenLibraryModule {}
