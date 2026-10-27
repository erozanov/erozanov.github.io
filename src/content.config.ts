import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const trips = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/trips' }),
  schema: z.object({
    title: z.string(),
    country: z.string(),
    number: z.string(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    summary: z.string(),
    cover: z.string(),
    coverAlt: z.string(),
    featured: z.boolean().default(false),
    status: z.enum(['draft', 'published']).default('published'),
    cities: z.array(
      z.object({
        name: z.string(),
        slug: z.string(),
        tagline: z.string(),
        image: z.string(),
        imageAlt: z.string(),
        coordinates: z.object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
        }),
      }),
    ),
  }),
});

const moments = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/moments' }),
  schema: z.object({
    title: z.string(),
    trip: reference('trips'),
    city: z.string(),
    citySlug: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    status: z.enum(['draft', 'published']).default('published'),
    media: z
      .array(
        z.object({
          type: z.enum(['photo', 'video']).default('photo'),
          src: z.string(),
          alt: z.string().default(''),
          poster: z.string().optional(),
          best: z.boolean().default(false),
        }),
      )
      .default([]),
  }),
});

export const collections = { trips, moments };
