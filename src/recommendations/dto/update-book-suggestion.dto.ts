import { IsIn } from 'class-validator';

export class UpdateBookSuggestionDto {
  @IsIn(['saved', 'dismissed'])
  status: 'saved' | 'dismissed';
}
