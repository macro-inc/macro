# UniFFI uses JNA to resolve the Rust scaffolding exports.
-keep class com.macro.documentsession.** { *; }
-keep class com.sun.jna.** { *; }
-dontwarn java.awt.**
# Generated bridge records are constructed and read by Jackson's Kotlin module.
-keep class com.macro.editor.bridge.** { *; }
-keep class kotlin.Metadata { *; }
-keepattributes Signature,InnerClasses,EnclosingMethod,RuntimeVisibleAnnotations,AnnotationDefault
