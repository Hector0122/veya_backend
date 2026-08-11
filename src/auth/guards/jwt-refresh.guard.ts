import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Protege POST /auth/refresh: valida el refresh token del body. */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}
