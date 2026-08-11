import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Protege endpoints que requieren access token válido. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
