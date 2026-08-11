import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { StringValue } from 'ms';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './types/jwt-payload.type';

const SALT_ROUNDS = 12;

/**
 * bcrypt trunca cualquier input a 72 bytes: un JWT completo lo supera de
 * sobra, así que hashearlo directo con bcrypt hace que dos refresh tokens
 * distintos del mismo usuario (mismo `sub`/`email` al inicio del payload)
 * colisionen en el hash. Por eso el refresh token se reduce primero a un
 * digest SHA-256 de largo fijo antes de guardarlo/compararlo.
 */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshTokenMatches(presented: string, storedHash: string): boolean {
  const presentedHash = Buffer.from(hashRefreshToken(presented), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (presentedHash.length !== stored.length) return false;
  return timingSafeEqual(presentedHash, stored);
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.usersService.create(email, passwordHash);

    return this.issueTokens(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return this.issueTokens(user.id, user.email);
  }

  async refresh(userId: string, email: string, presentedRefreshToken: string) {
    const user = await this.usersService.findById(userId);
    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Sesión inválida');
    }

    if (!refreshTokenMatches(presentedRefreshToken, user.refreshTokenHash)) {
      throw new UnauthorizedException('Sesión inválida');
    }

    // Rotación: cada refresh invalida el token anterior y emite uno nuevo.
    return this.issueTokens(userId, email);
  }

  async logout(userId: string) {
    await this.usersService.setRefreshTokenHash(userId, null);
  }

  private async issueTokens(userId: string, email: string): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      // El tipo de `jsonwebtoken` espera `number | ms.StringValue`; nuestro
      // valor viene validado por Joi como string tipo "15m"/"30d".
      expiresIn: this.configService.get<string>(
        'jwt.accessExpiresIn',
      ) as StringValue,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>(
        'jwt.refreshExpiresIn',
      ) as StringValue,
    });

    await this.usersService.setRefreshTokenHash(
      userId,
      hashRefreshToken(refreshToken),
    );

    return { accessToken, refreshToken };
  }
}
