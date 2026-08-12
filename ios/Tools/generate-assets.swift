#!/usr/bin/env swift

// Regenerates the iOS image assets from the web app's icon so the two never
// drift apart. Run it from the repo root after changing app/apple-icon.png:
//
//     swift ios/Tools/generate-assets.swift
//
// Writes:
//   AppIcon.appiconset/icon-1024.png  — flattened onto white, since iOS app
//                                       icons may not carry an alpha channel
//   AppLogo.imageset/logo{,@2x,@3x}.png — transparent, for the loading screen

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = repoRoot.appendingPathComponent("app/apple-icon.png")
let assets = repoRoot.appendingPathComponent("ios/CookingBeEasy/Assets.xcassets")

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("error: \(message)\n".utf8))
    exit(1)
}

guard
    let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
    let sourceImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else {
    fail("could not read \(source.path)")
}

/// Draws the source image, aspect-fit and centred, at `size` points square.
func render(size: Int, background: CGColor?) -> CGImage {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let alphaInfo: CGImageAlphaInfo = background == nil ? .premultipliedLast : .noneSkipLast

    guard
        let context = CGContext(
            data: nil,
            width: size,
            height: size,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: alphaInfo.rawValue
        )
    else {
        fail("could not create a \(size)x\(size) drawing context")
    }

    let bounds = CGRect(x: 0, y: 0, width: size, height: size)
    if let background {
        context.setFillColor(background)
        context.fill(bounds)
    }

    let scale = min(
        CGFloat(size) / CGFloat(sourceImage.width),
        CGFloat(size) / CGFloat(sourceImage.height)
    )
    let drawn = CGSize(
        width: CGFloat(sourceImage.width) * scale,
        height: CGFloat(sourceImage.height) * scale
    )
    context.interpolationQuality = .high
    context.draw(
        sourceImage,
        in: CGRect(
            x: (CGFloat(size) - drawn.width) / 2,
            y: (CGFloat(size) - drawn.height) / 2,
            width: drawn.width,
            height: drawn.height
        )
    )

    guard let image = context.makeImage() else { fail("could not render \(size)px") }
    return image
}

func write(_ image: CGImage, to url: URL) {
    try? FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )

    guard
        let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.png.identifier as CFString,
            1,
            nil
        )
    else {
        fail("could not write \(url.path)")
    }

    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fail("could not write \(url.path)") }
    print("wrote \(url.lastPathComponent) (\(image.width)px)")
}

let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)

write(
    render(size: 1024, background: white),
    to: assets.appendingPathComponent("AppIcon.appiconset/icon-1024.png")
)

// 160pt at each screen scale, matching the loading screen's logo size.
for (scale, suffix) in [(1, ""), (2, "@2x"), (3, "@3x")] {
    write(
        render(size: 160 * scale, background: nil),
        to: assets.appendingPathComponent("AppLogo.imageset/logo\(suffix).png")
    )
}
